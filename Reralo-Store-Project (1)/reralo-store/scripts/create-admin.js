require("dotenv").config();
const bcrypt = require("bcryptjs");
(async () => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error("Set ADMIN_PASSWORD in .env to a unique password with at least 12 characters first.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log("\nSet these environment variables on your hosting provider:\n");
  console.log("ADMIN_USERNAME=" + (process.env.ADMIN_USERNAME || "admin"));
  console.log("ADMIN_PASSWORD_HASH=" + hash);
  console.log("\nThen remove ADMIN_PASSWORD from production settings. Do not commit this hash to a public repository.\n");
})();
