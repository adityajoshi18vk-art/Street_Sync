import { execSync } from "node:child_process";

const ports = [3000, 3001, 3100];

for (const port of ports) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const lines = output.trim().split("\n");
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && pid !== String(process.pid)) {
          pids.add(Number(pid));
        }
      }
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
          console.log(`[clean-ports] Freed port ${port} (killed PID ${pid})`);
        } catch {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
            console.log(`[clean-ports] Freed port ${port} (taskkilled PID ${pid})`);
          } catch {}
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" });
    }
  } catch {
    // Port not in use, which is fine
  }
}
