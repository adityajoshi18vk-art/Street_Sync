import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, http } from 'wagmi';
import {
  ACTIVE_CHAIN, ARC_TESTNET, HARDHAT_LOCAL, ARC_RPC_URL, ARC_USDC_ADDRESS, ESCROW_ADDRESS,
  contractsDeployed, parseUsdc, resolveAddress, resolveDeploymentAddress
} from '../src/config/contracts';
import { approveUsdcExact } from '../src/lib/tx';

test('zero, malformed and explicitly invalid overrides are never contracts', () => {
  assert.equal(resolveAddress('0x' + '0'.repeat(40)), null);
  assert.equal(resolveAddress('0x123'), null);
  assert.equal(resolveAddress(undefined), null);
  assert.equal(resolveDeploymentAddress('', ARC_USDC_ADDRESS), null);
  assert.equal(resolveDeploymentAddress('0x' + '0'.repeat(40), ARC_USDC_ADDRESS), null);
  assert.equal(resolveDeploymentAddress(undefined, ARC_USDC_ADDRESS), ARC_USDC_ADDRESS);
});

test('Arc defaults use the current RPC and no fabricated escrow deployment', () => {
  assert.equal(ARC_RPC_URL, 'https://rpc.testnet.arc.io');
  assert.equal(ESCROW_ADDRESS, null);
  assert.equal(contractsDeployed, false);
});

test('USDC input remains exact and never rounds fractional base units', () => {
  assert.equal(parseUsdc('1.000001'), 1000001n);
  assert.equal(parseUsdc('9007199254740993.123456'), 9007199254740993123456n);
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '1.0000001']) {
    assert.throws(() => parseUsdc(input), /positive USDC amount/);
  }
});

test('missing deployment fails before any RPC or wallet request', async () => {
  let requests = 0;
  const config = createConfig({ chains: [ARC_TESTNET, HARDHAT_LOCAL], transports: {
    [HARDHAT_LOCAL.id]: http(),
    [ARC_TESTNET.id]: http('https://invalid.example', { fetchFn: async () => {
      requests++; throw new Error('RPC must not be called');
    } })
  } });
  await assert.rejects(approveUsdcExact({ config, owner: ARC_USDC_ADDRESS,
    spender: '0x' + '0'.repeat(40), amountUsdc: '1',
    writeContractAsync: async () => { requests++; throw new Error('Wallet must not be called'); }
  }), /contracts are not configured/);
  assert.equal(requests, 0);
});
