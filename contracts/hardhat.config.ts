import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const ARC_RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.arc-testnet.circlelabs.xyz";
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "00".repeat(32); // placeholder

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arcTestnet: {
      url: ARC_RPC_URL,
      chainId: 5042002,
      accounts: DEPLOYER_PK.startsWith("0x00000000") ? [] : [DEPLOYER_PK],
    },
  },
};

export default config;

