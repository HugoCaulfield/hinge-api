const https = require("https");
const dns = require("dns").promises;
const path = require("path");
const { execFile } = require("child_process");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { log } = require("../../utils/logger");

const SPAMHAUS_AUTH_NS = [
  "a.gns.spamhaus.org",
  "b.gns.spamhaus.org",
  "c.gns.spamhaus.org",
];
const SPAMHAUS_SEVERE_CODES = new Set([2, 3, 4, 9]);
const SPAMHAUS_PBL_CODES = new Set([10, 11]);
const MAX_SCAMALYTICS_SCORE = 9;
let spamhausNsCache = null;

/**
 * Logger avec timing
 */
const logWithTime = (message, startTime) => {
  if (typeof startTime !== "number") {
    log(message);
    return Date.now();
  }
  const duration = Date.now() - startTime;
  log(`${message} (${duration}ms)`);
  return Date.now(); // Retourne le nouveau timestamp
};

/**
 * Récupère l'IP publique via ifconfig.me/ip en passant par le proxy
 * @param {Object} proxyConfig - Configuration du proxy
 * @returns {Promise<string|null>} - L'IP publique ou null en cas d'erreur
 */
const getIpViaProxy = async (proxyConfig) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000; // 2 secondes
  const REQUEST_TIMEOUT = 5000; // 5 secondes

  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      const attemptStart = Date.now();
      const proxyUrl = `socks5://${proxyConfig.username}:${encodeURIComponent(
        proxyConfig.password
      )}@${proxyConfig.domain}:${proxyConfig.port}`;

      const options = {
        hostname: "api.ipify.org",
        path: "/?format=json",
        method: "GET",
        timeout: REQUEST_TIMEOUT,
        agent: new SocksProxyAgent(proxyUrl),
      };

      const ip = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = "";

          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const result = JSON.parse(data);
              if (!result?.ip) {
                reject(new Error(`IP absente dans la réponse: ${data}`));
                return;
              }
              resolve(result.ip);
            } catch (e) {
              reject(
                new Error(`Erreur lors du parsing de la réponse: ${e.message}`)
              );
            }
          });
        });

        req.on("error", (error) => {
          logWithTime(
            `❌ Erreur de requête (tentative ${retries + 1}/${MAX_RETRIES}):`
          );
          logWithTime(`   Type d'erreur: ${error.name}`);
          logWithTime(`   Message: ${error.message}`);
          logWithTime(`   Code: ${error.code}`);
          reject(error);
        });

        req.on("timeout", () => {
          logWithTime(`⏰ Timeout (tentative ${retries + 1}/${MAX_RETRIES})`);
          req.destroy();
          reject(new Error("Timeout"));
        });

        req.end();
      });

      logWithTime(`✅ IP obtenue: ${ip}`, attemptStart);
      return ip;
    } catch (error) {
      logWithTime(
        `❌ Erreur générale (tentative ${retries + 1}/${MAX_RETRIES}):`
      );
      logWithTime(`   Type d'erreur: ${error.name}`);
      logWithTime(`   Message: ${error.message}`);
      logWithTime(`   Code: ${error.code || "N/A"}`);

      if (retries < MAX_RETRIES - 1) {
        logWithTime(`🔄 Nouvelle tentative dans ${RETRY_DELAY}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      } else {
        return null;
      }
    }
  }

  return null;
};

async function getSpamhausAuthoritativeNsIps() {
  if (Array.isArray(spamhausNsCache) && spamhausNsCache.length > 0) {
    return spamhausNsCache;
  }

  const resolver = new dns.Resolver();
  const nsIps = [];
  for (const host of SPAMHAUS_AUTH_NS) {
    try {
      const ips = await resolver.resolve4(host);
      for (const ip of ips) {
        if (!nsIps.includes(ip)) {
          nsIps.push(ip);
        }
      }
    } catch (_) {
      // ignore single NS failure, continue with others
    }
  }

  if (nsIps.length === 0) {
    throw new Error("Spamhaus NS resolution failed");
  }

  spamhausNsCache = nsIps;
  return nsIps;
}

async function checkSpamhausReliability(ip) {
  const octets = String(ip || "").split(".");
  const isIpv4 =
    octets.length === 4 &&
    octets.every((item) => /^\d+$/.test(item) && Number(item) >= 0 && Number(item) <= 255);
  if (!isIpv4) {
    throw new Error(`Spamhaus check requires IPv4, got: ${ip}`);
  }

  const queryName = `${ip.split(".").reverse().join(".")}.zen.spamhaus.org`;
  const resolver = new dns.Resolver();
  resolver.setServers(await getSpamhausAuthoritativeNsIps());

  let records = [];
  try {
    records = await resolver.resolve4(queryName);
  } catch (error) {
    if (error?.code === "ENOTFOUND" || error?.code === "ENODATA") {
      records = [];
    } else {
      throw error;
    }
  }

  const codes = Array.from(
    new Set(
      records
        .filter((item) => /^127\.0\.0\.\d+$/.test(item))
        .map((item) => Number(item.split(".").pop()))
        .filter((value) => Number.isInteger(value))
    )
  ).sort((a, b) => a - b);

  const listed = codes.length > 0;
  const pblOnly = listed && codes.every((code) => SPAMHAUS_PBL_CODES.has(code));
  const severe = codes.some((code) => SPAMHAUS_SEVERE_CODES.has(code));
  const reliable = !listed || pblOnly;

  return { listed, pblOnly, severe, reliable, codes, records };
}

/**
 * Vérifie le risque d'une adresse IP via la page publique Scamalytics (sans clé API)
 * @param {string} ip - Adresse IP à vérifier
 * @returns {Promise<Object>} - Résultat avec statut, score/risque ou détail d'erreur
 */
async function checkScamalytics(ip) {
  const startTime = Date.now();
  const extractGeoFromScamalyticsHtml = (html) => {
    const patterns = [
      {
        key: "city",
        regex:
          /<(?:th|td)[^>]*>\s*City\s*<\/(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*<\/(?:th|td)>/i,
      },
      {
        key: "state",
        regex:
          /<(?:th|td)[^>]*>\s*(?:State(?:\s*\/\s*Province)?|Region)\s*<\/(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*<\/(?:th|td)>/i,
      },
      { key: "city", regex: /\bCity:\s*([^<\n\r]+)/i },
      {
        key: "state",
        regex:
          /\b(?:State(?:\s*\/\s*Province)?|Region):\s*([^<\n\r]+)/i,
      },
    ];

    const geo = { city: null, state: null };
    for (const pattern of patterns) {
      if (geo[pattern.key]) continue;
      const match = html.match(pattern.regex);
      if (match?.[1]) {
        geo[pattern.key] = match[1].trim();
      }
    }
    return geo;
  };
  const extractConnectionTypeFromScamalyticsHtml = (html) => {
    const patterns = [
      /<(?:th|td)[^>]*>\s*Connection\s*Type\s*<\/(?:th|td)>\s*<(?:th|td)[^>]*>\s*([^<]+?)\s*<\/(?:th|td)>/i,
      /\bConnection\s*Type:\s*([^<\n\r]+)/i,
    ];
    for (const regex of patterns) {
      const match = html.match(regex);
      if (match?.[1]) {
        return match[1].trim().toLowerCase();
      }
    }
    return null;
  };
  const runPythonFallback = () =>
    new Promise((resolve) => {
      const scriptPath = path.join(
        __dirname,
        "../../../scripts/python/scamalytics_score.py"
      );
      const configuredPython = process.env.SCAMALYTICS_PYTHON_PATH;
      const pythonAttempts = [
        ...(configuredPython
          ? [{ command: configuredPython, args: [] }]
          : []),
        ...(process.platform === "win32"
          ? [
              { command: "python", args: [] },
              { command: "py", args: [] },
              { command: "python3", args: [] },
            ]
          : [
              { command: "/Users/hugocaulfield/miniforge3/bin/python3", args: [] },
              { command: "/usr/bin/python3", args: [] },
              { command: "python3", args: [] },
              { command: "python", args: [] },
              { command: "arch", args: ["-x86_64", "python3"] },
              { command: "arch", args: ["-x86_64", "python"] },
              { command: "py", args: [] },
            ]),
      ];
      const attemptErrors = [];

      const tryCommand = (index) => {
        if (index >= pythonAttempts.length) {
          resolve({
            ok: false,
            reason: "python_unavailable",
            errorMessage:
              attemptErrors.length > 0
                ? `All Python fallback attempts failed: ${attemptErrors.join(
                    " | "
                  )}`
                : "No Python executable found for fallback",
          });
          return;
        }

        const attempt = pythonAttempts[index];
        const command = attempt.command;
        const commandArgs = [...attempt.args, scriptPath, ip];
        const commandLabel = [command, ...attempt.args].join(" ");
        execFile(
          command,
          commandArgs,
          { timeout: 15000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              if (error.code === "ENOENT") {
                tryCommand(index + 1);
                return;
              }
              const rawStdout = String(stdout || "").trim();
              if (rawStdout) {
                try {
                  const parsed = JSON.parse(rawStdout);
                  if (parsed?.ok) {
                    resolve({
                      ...parsed,
                      fallbackCommand: commandLabel,
                    });
                    return;
                  }

                  attemptErrors.push(
                    `${commandLabel}: ${parsed?.reason || "unknown_error"}`
                  );
                  tryCommand(index + 1);
                  return;
                } catch (_) {}
              }
              const message =
                error.message || (stderr && String(stderr).trim()) || null;
              attemptErrors.push(
                `${commandLabel}: ${error.code || "exec_error"}${
                  message ? ` (${message.split("\n")[0]})` : ""
                }`
              );
              tryCommand(index + 1);
              return;
            }

            try {
              const parsed = JSON.parse(String(stdout || "{}").trim());
              if (parsed?.ok) {
                logWithTime(
                  `✅ Scamalytics fallback Python OK (${commandLabel}): ${ip} (score=${parsed.score}, risk=${parsed.risk})`,
                  startTime
                );
                resolve({
                  ...parsed,
                  fallbackCommand: commandLabel,
                });
                return;
              }
              logWithTime(
                `❌ Scamalytics fallback Python échec (${commandLabel}): ${ip} (${parsed?.reason || "unknown"})`,
                startTime
              );
              attemptErrors.push(
                `${commandLabel}: ${parsed?.reason || "unknown_error"}`
              );
              tryCommand(index + 1);
            } catch (parseError) {
              attemptErrors.push(
                `${commandLabel}: python_parse_error (${parseError.message})`
              );
              tryCommand(index + 1);
            }
          }
        );
      };

      tryCommand(0);
    });

  return new Promise((resolve) => {
    const options = {
      hostname: "scamalytics.com",
      path: `/ip/${ip}`,
      method: "GET",
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", async () => {
        try {
          if (res.statusCode !== 200) {
            const cloudflareRayMatch = data.match(/Cloudflare Ray ID:\s*<strong[^>]*>([^<]+)/i);
            const cloudflareRayId = cloudflareRayMatch
              ? cloudflareRayMatch[1].trim()
              : null;
            logWithTime(
              `❌ Scamalytics HTTP ${res.statusCode}: ${ip}`,
              startTime
            );

            if (res.statusCode === 403) {
              const pythonResult = await runPythonFallback();
              if (pythonResult?.ok) {
                resolve(pythonResult);
                return;
              }
              resolve({
                ok: false,
                reason: `http_403_python_${pythonResult?.reason || "unknown"}`,
                statusCode: res.statusCode,
                cloudflareRayId,
                errorCode: pythonResult?.errorCode || null,
                errorMessage: pythonResult?.errorMessage || null,
              });
              return;
            }

            resolve({
              ok: false,
              reason: `http_${res.statusCode}`,
              statusCode: res.statusCode,
              cloudflareRayId,
            });
            return;
          }

          if (
            data.includes("Attention Required!") ||
            data.includes("Sorry, you have been blocked")
          ) {
            logWithTime(`❌ Scamalytics bloqué par Cloudflare: ${ip}`, startTime);
            const cloudflareRayMatch = data.match(/Cloudflare Ray ID:\s*<strong[^>]*>([^<]+)/i);
            const cloudflareRayId = cloudflareRayMatch
              ? cloudflareRayMatch[1].trim()
              : null;

            const pythonResult = await runPythonFallback();
            if (pythonResult?.ok) {
              resolve(pythonResult);
              return;
            }

            resolve({
              ok: false,
              reason: `cloudflare_blocked_python_${pythonResult?.reason || "unknown"}`,
              statusCode: res.statusCode,
              cloudflareRayId,
              errorCode: pythonResult?.errorCode || null,
              errorMessage: pythonResult?.errorMessage || null,
            });
            return;
          }

          const scoreMatch = data.match(/Fraud Score:\s*(\d+)/i);
          const fraudScore = scoreMatch ? Number(scoreMatch[1]) : null;

          if (fraudScore === null || Number.isNaN(fraudScore)) {
            logWithTime(
              `❌ Scamalytics score introuvable dans la page: ${ip}`,
              startTime
            );
            resolve({
              ok: false,
              reason: "score_not_found",
              statusCode: res.statusCode,
            });
            return;
          }

          const risk =
            fraudScore >= 75 ? "high" : fraudScore >= 35 ? "medium" : "low";
          const geo = extractGeoFromScamalyticsHtml(data);
          const connectionType = extractConnectionTypeFromScamalyticsHtml(data);

          logWithTime(
            `✅ Scamalytics score récupéré: ${ip} (score=${fraudScore}, risk=${risk})`,
            startTime
          );
          resolve({
            ok: true,
            score: fraudScore,
            risk,
            ispRisk: null,
            isLowRisk: risk === "low",
            connectionType,
            isDsl: connectionType === "dsl",
            city: geo.city,
            state: geo.state,
          });
        } catch (e) {
          logWithTime(
            `❌ Scamalytics erreur parsing: ${ip} - ${e.message}`,
            startTime
          );
          resolve({
            ok: false,
            reason: "parse_error",
            errorMessage: e.message,
          });
        }
      });
    });

    req.on("error", (error) => {
      logWithTime(
        `❌ Scamalytics erreur requête: ${ip} - ${error.message}`,
        startTime
      );
      resolve({
        ok: false,
        reason: "request_error",
        errorMessage: error.message,
        errorCode: error.code || null,
      });
    });

    req.on("timeout", () => {
      logWithTime(`❌ Scamalytics timeout: ${ip}`, startTime);
      req.destroy();
      resolve({
        ok: false,
        reason: "timeout",
      });
    });

    req.end();
  });
}

/**
 * Vérifie si une IP est valide selon les critères Scamalytics complets
 * @param {Object} scamalyticsData - Données complètes de Scamalytics
 * @returns {Object} - Résultat de validation avec détails
 */
function validateScamalyticsData(scamalyticsData) {
  const validationResult = {
    isValid: true,
    reasons: [],
    score: 0,
  };

  // 1. Vérifications critiques (red flags immédiats)
  const scam = scamalyticsData.scamalytics;
  const proxy = scam?.scamalytics_proxy;
  const external = scamalyticsData.external_datasources;

  // Blacklist externe - rejet immédiat
  if (scam?.is_blacklisted_external === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("IP blacklistée externement");
    return validationResult;
  }

  // Détection datacenter - rejet immédiat
  if (proxy?.is_datacenter === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("IP datacenter détectée");
    return validationResult;
  }

  // Détection VPN - rejet immédiat
  if (proxy?.is_vpn === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("VPN détecté");
    return validationResult;
  }

  // Apple iCloud Private Relay - exclusion recommandée
  if (proxy?.is_apple_icloud_private_relay === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("Apple iCloud Private Relay détecté");
    return validationResult;
  }

  // 2. Vérifications sources externes

  // FireHOL - détection proxy
  if (external?.firehol?.is_proxy === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("Proxy détecté par FireHOL");
    return validationResult;
  }

  // IPSum - blacklist IP spam
  if (external?.ipsum?.ip_blacklisted === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("IP blacklistée sur IPSum");
    return validationResult;
  }

  // Spamhaus DROP - source majeure de blacklist
  if (external?.spamhaus_drop?.ip_blacklisted === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("IP blacklistée sur Spamhaus DROP");
    return validationResult;
  }

  // x4bnet - détections multiples
  const x4bnet = external?.x4bnet;
  if (x4bnet?.is_tor === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("Réseau Tor détecté");
    return validationResult;
  }

  if (x4bnet?.is_datacenter === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("Datacenter détecté par x4bnet");
    return validationResult;
  }

  if (x4bnet?.is_vpn === true) {
    validationResult.isValid = false;
    validationResult.reasons.push("VPN détecté par x4bnet");
    return validationResult;
  }

  // 3. Vérifications des scores de risque
  if (scam?.scamalytics_risk !== "low") {
    validationResult.isValid = false;
    validationResult.reasons.push(
      `Risque Scamalytics élevé: ${scam.scamalytics_risk}`
    );
  }

  if (scam?.scamalytics_isp_risk !== "low") {
    validationResult.isValid = false;
    validationResult.reasons.push(
      `Risque ISP élevé: ${scam.scamalytics_isp_risk}`
    );
  }

  // 4. Calcul du score de qualité (pour information)
  validationResult.score = scam?.scamalytics_score || 0;

  return validationResult;
}

/**
 * Vérifie la qualité d'un proxy de manière optimisée
 * @param {Object} proxyConfig - Configuration du proxy
 * @returns {Promise<boolean>} - True si le proxy est valide, False sinon
 */
async function verifyProxy(proxyConfig) {
  const overallStartTime = Date.now();
  log(`🔍 Début vérification proxy: ${proxyConfig.domain}:${proxyConfig.port}`);

  try {
    // 1. Obtenir l'IP publique via ifconfig.me/ip
    const ipStartTime = Date.now();
    const ip = await getIpViaProxy(proxyConfig);
    if (!ip) {
      logWithTime(
        "❌ Proxy rejeté: Impossible de récupérer l'IP publique",
        overallStartTime
      );
      return false;
    }

    // Check if the delay is less than 5000ms
    const ipCheckDuration = Date.now() - ipStartTime;
    if (ipCheckDuration > 5000) {
      logWithTime(
        `❌ Proxy rejeté: Délai de récupération IP trop long (${ipCheckDuration}ms)`,
        overallStartTime
      );
      return false;
    }
    // 2. Vérifier Scamalytics via scraping public (sans clé API)
    const scamalyticsStartTime = Date.now();
    const scamalyticsResult = await checkScamalytics(ip);
    if (!scamalyticsResult?.ok) {
      logWithTime(
          `❌ Proxy rejeté: Erreur Scamalytics (${scamalyticsResult?.reason || "unknown"})` +
            `${scamalyticsResult?.statusCode ? `, HTTP ${scamalyticsResult.statusCode}` : ""}` +
            `${scamalyticsResult?.cloudflareRayId ? `, Ray ID ${scamalyticsResult.cloudflareRayId}` : ""}` +
            `${scamalyticsResult?.fallbackCommand ? `, fallback ${scamalyticsResult.fallbackCommand}` : ""}` +
            `${scamalyticsResult?.errorCode ? `, code ${scamalyticsResult.errorCode}` : ""}` +
            `${scamalyticsResult?.errorMessage ? `, ${scamalyticsResult.errorMessage}` : ""}`,
        overallStartTime
      );
      return false;
    }
    logWithTime("✅ Données Scamalytics récupérées", scamalyticsStartTime);

    const score = Number(scamalyticsResult.score);
    if (!Number.isFinite(score)) {
      logWithTime(
        `❌ Proxy rejeté: Score Scamalytics invalide (${scamalyticsResult.score})`,
        overallStartTime
      );
      return false;
    }

    if (score > MAX_SCAMALYTICS_SCORE) {
      logWithTime(
        `❌ Proxy rejeté: Scamalytics score trop élevé (${score} > ${MAX_SCAMALYTICS_SCORE})`,
        overallStartTime
      );
      return false;
    }

    const connectionType = (
      scamalyticsResult.connectionType ||
      scamalyticsResult.connection_type ||
      ""
    )
      .toString()
      .trim()
      .toLowerCase();
    const isDsl =
      typeof scamalyticsResult.isDsl === "boolean"
        ? scamalyticsResult.isDsl
        : connectionType === "dsl";

    //if (isDsl !== true) {
    //  logWithTime(
    //    `❌ Proxy rejeté: Connection Type non DSL (${connectionType || "unknown"})`,
    //    overallStartTime
    //  );
    //  return false;
    //}

    const spamhausStartTime = Date.now();
    const spamhaus = await checkSpamhausReliability(ip);
    if (!spamhaus.reliable) {
      logWithTime(
        `❌ Proxy rejeté: Spamhaus non fiable (codes: ${spamhaus.codes.join(", ") || "none"})`,
        overallStartTime
      );
      return false;
    }
    logWithTime(
      `✅ Spamhaus fiable (listed=${spamhaus.listed}, pblOnly=${spamhaus.pblOnly}, codes=${spamhaus.codes.join(", ") || "none"})`,
      spamhausStartTime
    );

    logWithTime("🎉 Proxy validé avec succès", overallStartTime);

    return {
      success: true,
      ip,
      scamalyticsScore: score,
      scamalyticsRisk: scamalyticsResult?.risk ?? null,
      scamalyticsIspScore: scamalyticsResult?.ispRisk ?? null,
      scamalyticsConnectionType: connectionType || null,
      scamalyticsIsDsl: isDsl,
      spamhausReliable: spamhaus.reliable,
      spamhausListed: spamhaus.listed,
      spamhausCodes: spamhaus.codes,
      //ipLocationAccuracyKm: geoData?.ip_location_accuracy_km || null,
      //ipGeolocation: geoData?.ip_geolocation || null,
      //dbipIpCity: dbipData?.ip_city || null,
      //dbipIpGeolocation: dbipData?.ip_geolocation || null,
      //dbipIspName: dbipData?.isp_name || null,
      //dbipConnectionType: dbipData?.connection_type || null,
      //ip2proxyProxyType: ip2ProxyData?.proxy_type || null,
    };
  } catch (error) {
    logWithTime(
      `❌ Erreur lors de la vérification: ${error.message}`,
      overallStartTime
    );
    return false;
  }
}

/**
 * Generates proxy configuration information based on location
 * @param {Object} location - Location object containing state information
 * @param {string} provider - Provider name
 * @param {string} state_or_city - "state" or "city"
 * @returns {Promise<Object>} Proxy configuration object
 */
async function generateProxyInfo(
  location,
  provider = "marsproxies",
  state_or_city = "state",
  proxySettings = {}
) {
  const startTime = Date.now();
  log(`🚀 Début génération proxy pour ${location.city}, ${location.state}`);

  try {
    const configStartTime = Date.now();
    let proxyConfig = await generateProxyConfig(
      location,
      provider,
      state_or_city,
      proxySettings
    );
    const fullCandidate = `${proxyConfig.domain}:${proxyConfig.port}:${proxyConfig.username}:${proxyConfig.password}`;
    log(
      `🧩 Proxy candidate (full): ${fullCandidate}`
    );
    logWithTime("✅ Configuration proxy générée", configStartTime);

    const testStartTime = Date.now();
    log("🧪 Test de la configuration proxy...");
    const verifyResult = await verifyProxy(proxyConfig);

    if (!verifyResult || !verifyResult.success) {
      logWithTime("❌ Proxy invalide", startTime);
      return null;
    }

    logWithTime("✅ Proxy valide trouvé", testStartTime);
    logWithTime(`🎯 Génération proxy terminée avec succès`, startTime);
    log("✅ Configuration finale:", proxyConfig);

    // Add IP and additional information to proxy config
    proxyConfig.ip = verifyResult.ip;
    proxyConfig.asn = verifyResult.asn;
    proxyConfig.asnOrg = verifyResult.asnOrg;
    proxyConfig.timezone = verifyResult.timezone;
    // Add Scamalytics data for downstream metadata
    proxyConfig.scamalyticsScore = verifyResult.scamalyticsScore;
    proxyConfig.scamalyticsRisk = verifyResult.scamalyticsRisk;
    proxyConfig.scamalyticsIspScore = verifyResult.scamalyticsIspScore;
    proxyConfig.scamalyticsConnectionType =
      verifyResult.scamalyticsConnectionType;
    proxyConfig.scamalyticsIsDsl = verifyResult.scamalyticsIsDsl;
    proxyConfig.spamhausReliable = verifyResult.spamhausReliable;
    proxyConfig.spamhausListed = verifyResult.spamhausListed;
    proxyConfig.spamhausCodes = verifyResult.spamhausCodes;
    proxyConfig.ipLocationAccuracyKm = verifyResult.ipLocationAccuracyKm;
    proxyConfig.ipGeolocation = verifyResult.ipGeolocation;
    proxyConfig.dbipIpCity = verifyResult.dbipIpCity;
    proxyConfig.dbipIpGeolocation = verifyResult.dbipIpGeolocation;
    proxyConfig.dbipIspName = verifyResult.dbipIspName;
    proxyConfig.dbipConnectionType = verifyResult.dbipConnectionType;
    proxyConfig.ip2proxyProxyType = verifyResult.ip2proxyProxyType;

    return proxyConfig;
  } catch (error) {
    logWithTime(`❌ Erreur génération proxy: ${error.message}`, startTime);
    return null;
  }
}

// Helper function to generate proxy configuration (inchangée mais avec async/await pour cohérence)
async function generateProxyConfig(
  location,
  provider,
  state_or_city,
  proxySettings = {}
) {
  let random_sid = Math.random()
    .toString(36)
    .substring(2, 10)
    .replace(/[^a-z0-9]/g, "");
  let password, username;
  // Random number between 10000 and 10100 inclus
  let random_number = Math.floor(Math.random() * 101) + 10000;
  let random_number_2 = Math.floor(Math.random() * 101) + 1;

  const normalizeToken = (value = "", mode = "underscore") => {
    const base = String(value || "").trim().toLowerCase();
    if (!base) return "";
    if (mode === "compact") {
      return base.replace(/\s+/g, "");
    }
    return base.replace(/\s+/g, "_");
  };

  const getMarsSettings = () => {
    const marsCfg = proxySettings.marsproxies || proxySettings.marsProxies || {};

    return {
      domain:
        process.env.MARSPROXIES_DOMAIN ||
        process.env.MARSPROXIES_HOST ||
        marsCfg.domain ||
        marsCfg.host ||
        "91.239.130.17",
      port: String(process.env.MARSPROXIES_PORT || marsCfg.port || "44445"),
      username:
        process.env.MARSPROXIES_USERNAME || marsCfg.username || "mr88909jCof",
      password: process.env.MARSPROXIES_PASSWORD || marsCfg.password || "",
      passwordPrefix:
        process.env.MARSPROXIES_PASSWORD_PREFIX ||
        marsCfg.passwordPrefix ||
        "Mkt28Uzxh5",
      passwordTemplate:
        process.env.MARSPROXIES_PASSWORD_TEMPLATE ||
        marsCfg.passwordTemplate ||
        "",
      protocol:
        process.env.MARSPROXIES_PROTOCOL || marsCfg.protocol || "socks5",
      locationTag:
        process.env.MARSPROXIES_LOCATION_TAG || marsCfg.locationTag || "state",
      locationSource:
        process.env.MARSPROXIES_LOCATION_SOURCE ||
        marsCfg.locationSource ||
        "city",
      locationFormat:
        process.env.MARSPROXIES_LOCATION_FORMAT ||
        marsCfg.locationFormat ||
        "compact",
      fast: process.env.MARSPROXIES_FAST || marsCfg.fast || "1",
      stable: process.env.MARSPROXIES_STABLE || marsCfg.stable || "1",
      lifetime: process.env.MARSPROXIES_LIFETIME || marsCfg.lifetime || "168h",
      ultraset: process.env.MARSPROXIES_ULTRASET || marsCfg.ultraset || "1",
    };
  };

  const renderTemplate = (template, vars) =>
    String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) =>
      vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ""
    );

  switch (provider) {
    case "marsproxies":
      const mars = getMarsSettings();
      // Force city targeting for Mars proxies to avoid state-only credentials.
      const scope = "city";
      const country = String(
        location.CountryCode || location.countryCode || "us"
      ).toLowerCase();
      const locationValue = location.city || "";
      const locationKey = normalizeToken(locationValue, mars.locationFormat);
      if (!locationKey) {
        throw new Error(
          `Mars proxy requires a city token but city is missing (state=${location.state || "?"})`
        );
      }

      password =
        mars.password ||
        (mars.passwordTemplate
          ? renderTemplate(mars.passwordTemplate, {
              country,
              scope,
              location: locationKey,
              city: normalizeToken(location.city || "", mars.locationFormat),
              state: normalizeToken(location.state || "", mars.locationFormat),
              session: random_sid,
              fast: mars.fast,
              stable: mars.stable,
              lifetime: mars.lifetime,
              ultraset: mars.ultraset,
            })
          : `${mars.passwordPrefix}_country-${country}_${scope}-${locationKey}_fast-${mars.fast}_stable-${mars.stable}_session-${random_sid}_lifetime-${mars.lifetime}_ultraset-${mars.ultraset}`);
      if (!/_city-[^_]+/i.test(password)) {
        throw new Error(
          `Mars proxy password must include a city token (_city-...). Generated value: ${password}`
        );
      }

      return {
        domain: mars.domain,
        port: mars.port,
        username: mars.username,
        password: password,
        protocol: mars.protocol,
      };
    case "proxyempire":
      const city = location.city.toLowerCase().replace(/ /g, "+");
      random_sid = Math.random()
        .toString(36)
        .substring(2, 10)
        .replace(/[^a-z0-9]/g, "");

      if (state_or_city === "state") {
        username = `r_f221e27ea3-country-${
          location.CountryCode
        }-region-${location.state
          .toLowerCase()
          .replace(/ /g, "")}-sid-${random_sid}`;
      } else {
        username = `r_f221e27ea3-country-${location.CountryCode}-city-${city}-sid-${random_sid}`;
      }
      return {
        domain: "v2.proxyempire.io",
        port: "5000",
        username: username,
        password: "a8e588db63",
      };
    case "dataimpulse":
      return {
        domain: "gw.dataimpulse.com",
        port: random_number.toString(),
        username: `c4a432c1e89d954a0439__cr.${
          location.CountryCode
        };state.${location.state
          .toLowerCase()
          .replace(/ /g, "")};city.${location.city
          .toLowerCase()
          .replace(/ /g, "")};anon;sessid.${random_number_2};sessttl.120`,
        password: "69daad472aa68dc6",
      };
    case "dataimpulse_mobile":
      return {
        domain: "gw.dataimpulse.com",
        port: random_number.toString(),
        username: `acf681ba0d562726c690__cr.${
          location.CountryCode
        };state.${location.state
          .toLowerCase()
          .replace(/ /g, "")};city.${location.city
          .toLowerCase()
          .replace(/ /g, "")}`,
        password: "5f28abec73e5d06e",
      };
    case "anyIp":
      const sessionId = `randSession${Math.floor(Math.random() * 10000)}`;
      let anyIpUsername;

      // Use GPS coordinates if available, otherwise fall back to region-based targeting
      if (location.latitude && location.longitude) {
        anyIpUsername = `user_b48bac,type_residentialonly,lat_${location.latitude},lon_${location.longitude},session_${sessionId},sesstime_10000,sessasn_strict,sessipcollision_strict`;
      } else {
        // Fallback to state-level targeting when GPS coordinates are not available
        anyIpUsername = `user_b48bac,type_residential,country_US,region_${location.state
          .toLowerCase()
          .replace(/ /g, "")},session_${sessionId}`;
      }

      return {
        domain: "portal.anyip.io",
        port: "1080",
        username: anyIpUsername,
        password: "544fd8",
      };
    default:
      throw new Error("Provider inconnu");
  }
}

module.exports = {
  generateProxyInfo,
  checkScamalytics,
};
