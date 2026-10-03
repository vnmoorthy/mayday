// Shapes shared by the flight replay loader (server) and the replay player
// (client). Every field is copied from a recorded row; nothing is invented.

export type ReplayKind = "mayday" | "flare" | "route" | "ask" | "rescue" | "landed";

export type ReplayEntry = {
  id: string;
  kind: ReplayKind;
  // Formatted on the server ("14:02:11 UTC") so server and client render the same text.
  clock: string | null;
  head: string;
  tag?: string;
  // The key line of the recorded error.
  error?: string;
  // Flare text.
  body?: string;
  snippet?: string | null;
  site?: { slug: string; title: string };
  // Route task and steps.
  task?: string;
  steps?: { n: number; text: string }[];
  // The stop signal's black box: what the agent tried and what happened.
  attempts?: { step: number; action: string; result: string }[];
  note?: string;
};

export type Replay = {
  error: string | null;
  // False until the first HivePay row lands in the database.
  hasData: boolean;
  // True until a landing is reported on the charted route.
  incomplete: boolean;
  pioneer: ReplayEntry[];
  follower: ReplayEntry[];
  pioneerFails: number;
  // True once the pioneer has charted the route.
  pioneerLanded: boolean;
  followerFails: number;
  // True once anything the follower did is on record.
  followerFlown: boolean;
  sitesCharted: number;
  routeCharted: boolean;
};
