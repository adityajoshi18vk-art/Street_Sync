import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys JanLekha with the deployer as DEFAULT_ADMIN_ROLE. Demo roles are granted separately.
export default buildModule("JanLekhaModule", (m) => {
  const admin = m.getAccount(0);
  const janLekha = m.contract("JanLekha", [admin]);
  return { janLekha };
});
