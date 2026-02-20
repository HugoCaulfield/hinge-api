const { getModelAge } = require("../../../config/photo-models");

function getZodiacSign(day, month) {
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "Aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "Taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "Gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "Cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "Leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "Virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "Libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21))
    return "Scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21))
    return "Sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19))
    return "Capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18))
    return "Aquarius";
  return "Pisces";
}

function formatDateParts(day, month, year) {
  const formattedDay = day.toString().padStart(2, "0");
  const formattedMonth = month.toString().padStart(2, "0");
  const birthDate = `${formattedMonth}/${formattedDay}/${year}`;
  const zodiacSign = getZodiacSign(day, month);
  return { birthDate, zodiacSign };
}

function generateBirthDate(options = {}) {
  const { modelKey = null, age: explicitAge = null } = options || {};
  const age =
    typeof explicitAge === "number"
      ? explicitAge
      : modelKey
      ? getModelAge(modelKey)
      : null;

  if (typeof age === "number" && age > 0) {
    const now = new Date();
    const latestBirthDate = new Date(now);
    latestBirthDate.setFullYear(latestBirthDate.getFullYear() - age);
    const earliestBirthDate = new Date(now);
    earliestBirthDate.setFullYear(earliestBirthDate.getFullYear() - age - 1);
    earliestBirthDate.setDate(earliestBirthDate.getDate() + 1);

    const randomTimestamp =
      earliestBirthDate.getTime() +
      Math.random() * (latestBirthDate.getTime() - earliestBirthDate.getTime());
    const birthDateObj = new Date(randomTimestamp);
    const day = birthDateObj.getDate();
    const month = birthDateObj.getMonth() + 1;
    const year = birthDateObj.getFullYear();

    return formatDateParts(day, month, year);
  }

  const year = Math.floor(Math.random() * (2004 - 2000 + 1)) + 2000;
  const month = Math.floor(Math.random() * 12) + 1;
  let day;

  switch (month) {
    case 2:
      day = Math.floor(Math.random() * 28) + 1;
      break;
    case 4:
    case 6:
    case 9:
    case 11:
      day = Math.floor(Math.random() * 30) + 1;
      break;
    default:
      day = Math.floor(Math.random() * 31) + 1;
  }

  return formatDateParts(day, month, year);
}

module.exports = {
  generateBirthDate,
};
