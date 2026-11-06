// EIP-1193 test wallet injected before page scripts run (Playwright addInitScript).
//
// It never holds a private key: signing-capable calls are forwarded through
// window.__e2eRpc (a Playwright binding) to the Hardhat node, whose dev accounts
// are unlocked. Account, chain and connection state live in localStorage so they
// survive navigations within a test.
(() => {
  const KEY = "__e2eWallet";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null") || { account: null, chainId: 31337, connected: false };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const listeners = {};
  const emit = (event, value) => (listeners[event] || []).forEach((fn) => fn(value));
  const hex = (n) => "0x" + n.toString(16);
  const rpcError = (code, message, data) => Object.assign(new Error(message), { code, data });
  const forward = async (method, params) => {
    const res = await window.__e2eRpc(method, params);
    if (res.error) throw rpcError(res.error.code, res.error.message, res.error.data);
    return res.result;
  };

  const provider = {
    isE2EWallet: true,
    async request({ method, params = [] }) {
      const s = load();
      switch (method) {
        case "eth_requestAccounts":
          if (!s.account) throw rpcError(4001, "No test account selected");
          save({ ...s, connected: true });
          return [s.account];
        case "eth_accounts":
          return s.connected && s.account ? [s.account] : [];
        case "eth_chainId":
          return hex(s.chainId);
        case "net_version":
          return String(s.chainId);
        case "wallet_requestPermissions":
          save({ ...s, connected: true });
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_getPermissions":
          return s.connected ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          save({ ...s, connected: false });
          return null;
        case "wallet_switchEthereumChain": {
          const chainId = parseInt(params[0].chainId, 16);
          save({ ...s, chainId });
          emit("chainChanged", hex(chainId));
          return null;
        }
        case "wallet_addEthereumChain":
          return null;
        case "eth_sendTransaction": {
          if (s.chainId !== 31337) throw rpcError(4901, "Test wallet can only send on chain 31337");
          return forward("eth_sendTransaction", [{ ...params[0], from: s.account }]);
        }
        default:
          return forward(method, params);
      }
    },
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
      return provider;
    },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn);
      return provider;
    },
  };

  window.__wallet = {
    setAccount(account) {
      save({ ...load(), account });
      emit("accountsChanged", [account]);
    },
    setChain(chainId) {
      save({ ...load(), chainId });
      emit("chainChanged", hex(chainId));
    },
  };
  window.ethereum = provider;
})();
