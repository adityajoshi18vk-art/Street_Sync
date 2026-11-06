import { startIndexer, stopIndexer } from "./src/indexer.ts";
import dbAccess from "./src/db.ts";
await startIndexer();
await new Promise((r) => setTimeout(r, 20000));
console.log("cursor", dbAccess.getCursor(5042002), "bounties", JSON.stringify(dbAccess.raw.prepare("select bounty_id,status,total_pledged from bounties").all()));
stopIndexer(); process.exit(0);
