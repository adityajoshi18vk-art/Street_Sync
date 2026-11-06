"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ACTIVE_CHAIN, HARDHAT_LOCAL, ARC_TESTNET, ARC_RPC_URL } from "./contracts";

export const SUPPORTED_CHAINS = [ARC_TESTNET, HARDHAT_LOCAL] as const;

export const wagmiConfig = createConfig({
  chains: ACTIVE_CHAIN.id === HARDHAT_LOCAL.id ? [HARDHAT_LOCAL, ARC_TESTNET] : SUPPORTED_CHAINS,
  ssr: true,
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [ARC_TESTNET.id]: http(ARC_RPC_URL),
    [HARDHAT_LOCAL.id]: http(process.env.NEXT_PUBLIC_LOCALHOST_RPC_URL)
  }
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export { wagmiConfig as config };
