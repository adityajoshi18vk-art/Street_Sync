import { keccak256, toHex, zeroHash, type Hex } from "viem";

export const ROLE_NAMES = ["DEFAULT_ADMIN_ROLE", "DEPARTMENT_ROLE", "VENDOR_ROLE", "INSPECTOR_ROLE", "PAO_ROLE"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

/** Same derivation as JanLekha.sol (covered by the contract tests). */
export const ROLE_IDS: Record<RoleName, Hex> = {
  DEFAULT_ADMIN_ROLE: zeroHash,
  DEPARTMENT_ROLE: keccak256(toHex("DEPARTMENT_ROLE")),
  VENDOR_ROLE: keccak256(toHex("VENDOR_ROLE")),
  INSPECTOR_ROLE: keccak256(toHex("INSPECTOR_ROLE")),
  PAO_ROLE: keccak256(toHex("PAO_ROLE")),
};

export const ROLE_LABELS: Record<RoleName, string> = {
  DEFAULT_ADMIN_ROLE: "Admin",
  DEPARTMENT_ROLE: "Department",
  VENDOR_ROLE: "Vendor",
  INSPECTOR_ROLE: "Inspector",
  PAO_ROLE: "PAO",
};
