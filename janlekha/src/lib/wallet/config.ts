import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { appChain } from "./chain";

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected({ shimDisconnect: true })],
  // Reads and receipts always use the app's RPC, never the wallet's, so a wallet on the
  // wrong network cannot change what the page shows.
  transports: { [appChain.id]: http(appChain.rpcUrls.default.http[0], { timeout: 15_000 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
