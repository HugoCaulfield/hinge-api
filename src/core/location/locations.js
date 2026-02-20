const turf = require('@turf/turf');
const fs = require('fs');
const csvParser = require('csv-parser');
const { log } = require('../../utils/logger');

/**
 * Génère un point aléatoire dans un rayon de 300 mètres autour d'un point donné
 */
function getRandomPointInRadius(latitude, longitude, radiusInMeters = 500) {
    // Créer un point à partir des coordonnées données
    const center = turf.point([parseFloat(longitude), parseFloat(latitude)]);

    // Créer un cercle de 300m autour du point
    const circle = turf.circle(center, radiusInMeters / 1000); // turf utilise des kilomètres

    // Générer un point aléatoire dans ce cercle
    const point = randomPointInPolygon(circle);

    return point;
}

/**
 * Génère un point aléatoire dans un polygone avec turf
 */
function randomPointInPolygon(polygon) {
    let point;
    let tries = 0;

    do {
        point = turf.randomPoint(1, { bbox: turf.bbox(polygon) }).features[0];
        tries++;
    } while (!turf.booleanPointInPolygon(point, polygon) && tries < 50);

    if (turf.booleanPointInPolygon(point, polygon)) {
        return {
            latitude: point.geometry.coordinates[1].toFixed(7),
            longitude: point.geometry.coordinates[0].toFixed(7)
        };
    }

    throw new Error('Impossible de générer un point dans ce polygone après 50 essais.');
}

/**
 * Fonction principale - Maintenant génère un point aléatoire dans un rayon de 300m
 */
async function getRandomLocationInCity(location) {
    try {
        const latitude = parseFloat(location.lat);
        const longitude = parseFloat(location.lon);
        
        log(`→ Génération d'un point aléatoire dans un rayon de 300m autour de [${latitude}, ${longitude}]...`);

        const point = getRandomPointInRadius(latitude, longitude);

        log(`Coordonnée aléatoire générée:`, point);
        
        // Keep full area code string for provider-specific processing
        const areaCode = location.area_code || null;
        log(`📍 Available area codes: ${areaCode}`);
        
        // Return the enhanced location object with new coordinates
        return {
            ...location,
            lat: point.latitude,
            lon: point.longitude,
            latitude: point.latitude,
            longitude: point.longitude,
            areaCode: areaCode // Add processed area code
        };
    } catch (err) {
        console.error('Erreur :', err.message);
        throw err; // Propager l'erreur pour la gérer dans l'application
    }
}

async function loadLocations(locationsPath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(locationsPath)
            .pipe(csvParser())
            .on('data', (data) => results.push(data))
            .on('error', (error) => reject(error))
            .on('end', () => {
                log(`Successfully loaded ${results.length} locations from CSV`);
                resolve(results);
            });
    });
}

module.exports = {
    getRandomLocationInCity,
    loadLocations
};
