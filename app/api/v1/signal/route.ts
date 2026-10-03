// "Send a stop signal" is the public name for reporting a failure. This route
// is the same handler as /api/v1/mayday, the name the database still uses.
export { POST, OPTIONS } from "../mayday/route";

export const dynamic = "force-dynamic";
