import { mailReadiness } from "../apps/api/src/mail-config.js";

const result = mailReadiness();
console.log(result.message);
process.exitCode = result.ready ? 0 : 1;
