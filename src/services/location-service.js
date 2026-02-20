const {
  findAndValidateLocation,
} = require("../../current_telegram_bot/src/core/location/location-utils");
const {
  getRandomLocationInCity,
} = require("../../current_telegram_bot/src/core/location/locations");

function createLocationService() {
  async function validateAndResolve(state, city) {
    const input = `${state}, ${city}`;
    const result = await findAndValidateLocation(input);
    if (!result.success) {
      const err = new Error(result.error || "Invalid location");
      err.code = "INVALID_LOCATION";
      throw err;
    }
    return result.location;
  }

  async function randomizeCoordinates(location) {
    return getRandomLocationInCity(location);
  }

  return {
    validateAndResolve,
    randomizeCoordinates,
  };
}

module.exports = {
  createLocationService,
};
