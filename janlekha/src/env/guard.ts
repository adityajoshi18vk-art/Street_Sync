// Next.js inlines every NEXT_PUBLIC_* variable into the browser bundle, so a
// secret given that prefix by mistake would ship to every visitor.
const SECRET_PATTERN = /PRIVATE_KEY|SECRET|PASSWORD|DATABASE_URL|MNEMONIC|API_KEY/i;

export function assertNoPublicSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const leaked = Object.keys(env).filter(
    (key) => key.startsWith("NEXT_PUBLIC_") && SECRET_PATTERN.test(key),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to start: secret-looking variables are exposed to the browser: ${leaked.join(", ")}. ` +
        "Remove the NEXT_PUBLIC_ prefix and read them from server-only code.",
    );
  }
}
