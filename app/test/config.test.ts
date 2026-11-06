import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARC_RPC_URL, ARC_USDC_ADDRESS, ESCROW_ADDRESS,
  contractsDeployed, parseUsdc, resolveAddress, resolveDeploymentAddress
} from '../src/config/contracts';
import deploymentFile from '../../contracts/deployments/arcTestnet.json';

test('zero, malformed and explicitly invalid overrides are never contracts', () => {
  assert.equal(resolveAddress('0x' + '0'.repeat(40)), null);
  assert.equal(resolveAddress('0x123'), null);
  assert.equal(resolveAddress(undefined), null);
  assert.equal(resolveDeploymentAddress('', ARC_USDC_ADDRESS), null);
  assert.equal(resolveDeploymentAddress('0x' + '0'.repeat(40), ARC_USDC_ADDRESS), null);
  assert.equal(resolveDeploymentAddress(undefined, ARC_USDC_ADDRESS), ARC_USDC_ADDRESS);
});

test('Arc defaults use the current RPC and the recorded escrow deployment', () => {
  assert.equal(ARC_RPC_URL, 'https://rpc.testnet.arc.io');
  assert.equal(ESCROW_ADDRESS, deploymentFile.contracts.StreetSyncEscrow.address);
  assert.equal(contractsDeployed, true);
});

test('USDC input remains exact and never rounds fractional base units', () => {
  assert.equal(parseUsdc('1.000001'), 1000001n);
  assert.equal(parseUsdc('9007199254740993.123456'), 9007199254740993123456n);
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '1.0000001']) {
    assert.throws(() => parseUsdc(input), /positive USDC amount/);
  }
});
