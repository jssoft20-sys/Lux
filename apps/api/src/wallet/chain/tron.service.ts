import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { TronWeb } from 'tronweb';
import { SettingsService } from '../../settings/settings.service';
import { loadEnv } from '../../config/env';

export interface Trc20Transfer {
  txHash: string;
  from: string;
  to: string;
  amount: string; // decimal string in USDT
  blockTimestamp: number;
}

export interface TxInfo {
  found: boolean;
  blockNumber?: number;
  success?: boolean;
}

const TRC20_ABI = [
  { constant: true, inputs: [{ name: '_owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: 'balance', type: 'uint256' }], type: 'function' },
  { constant: false, inputs: [{ name: '_to', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], type: 'function' },
  { constant: true, inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], type: 'function' },
];

/**
 * TRON (TRC20 USDT) provider: address derivation, TronGrid queries, hot-wallet broadcast.
 * Deposit addresses are derived from a public xpub only — the API never needs deposit private keys.
 * Sweeping deposits to the hot wallet is done by the custody tooling (see docs/SECURITY.md).
 */
@Injectable()
export class TronService {
  private readonly logger = new Logger(TronService.name);

  constructor(private readonly settings: SettingsService) {}

  // ─── addresses ───

  static addressFromPublicKey(pub: Uint8Array): string {
    const uncompressed = secp256k1.ProjectivePoint.fromHex(pub).toRawBytes(false).slice(1); // drop 0x04
    const hash = keccak_256(uncompressed).slice(-20);
    const payload = new Uint8Array(21);
    payload[0] = 0x41;
    payload.set(hash, 1);
    const checksum = sha256(sha256(payload)).slice(0, 4);
    const full = new Uint8Array(25);
    full.set(payload);
    full.set(checksum, 21);
    return bs58.encode(full);
  }

  static addressFromPrivateKey(privHex: string): string {
    return TronService.addressFromPublicKey(secp256k1.getPublicKey(privHex.replace(/^0x/, ''), true));
  }

  static isAddress(addr: string): boolean {
    try {
      return TronWeb.isAddress(addr);
    } catch {
      return false;
    }
  }

  async deriveDepositAddress(index: number): Promise<string> {
    const xpub = await this.settings.get('tron.deposit_xpub');
    if (!xpub) throw new Error('DEPOSIT_XPUB is not configured');
    const hd = HDKey.fromExtendedKey(xpub);
    const child = hd.deriveChild(index);
    if (!child.publicKey) throw new Error('cannot derive public key');
    return TronService.addressFromPublicKey(child.publicKey);
  }

  async isConfigured() {
    return !!(await this.settings.get('tron.deposit_xpub'));
  }

  simulated() {
    return loadEnv().DEV_SIMULATE_CHAIN;
  }

  // ─── TronGrid ───

  private async grid() {
    const [url, key, contract, confirmations] = await Promise.all([
      this.settings.get('tron.api_url'),
      this.settings.get('tron.api_key'),
      this.settings.get('tron.usdt_contract'),
      this.settings.num('tron.required_confirmations'),
    ]);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['TRON-PRO-API-KEY'] = key;
    return { url: url.replace(/\/+$/, ''), headers, contract, confirmations };
  }

  async incomingTransfers(address: string, sinceMs: number): Promise<Trc20Transfer[]> {
    const { url, headers, contract } = await this.grid();
    const res = await axios.get(`${url}/v1/accounts/${address}/transactions/trc20`, {
      params: { only_to: true, only_confirmed: false, contract_address: contract, min_timestamp: sinceMs, limit: 200, order_by: 'block_timestamp,asc' },
      headers,
      timeout: 20_000,
    });
    const items: any[] = res.data?.data ?? [];
    return items
      .filter((t) => t.type === 'Transfer' && t.to === address && t.token_info?.address === contract)
      .map((t) => ({
        txHash: t.transaction_id,
        from: t.from,
        to: t.to,
        amount: (Number(t.value) / 10 ** Number(t.token_info?.decimals ?? 6)).toFixed(6),
        blockTimestamp: Number(t.block_timestamp),
      }));
  }

  async txInfo(txHash: string): Promise<TxInfo> {
    const { url, headers } = await this.grid();
    const res = await axios.post(`${url}/wallet/gettransactioninfobyid`, { value: txHash }, { headers, timeout: 20_000 });
    const d = res.data || {};
    if (!d.id) return { found: false };
    return { found: true, blockNumber: Number(d.blockNumber), success: !d.receipt?.result || d.receipt.result === 'SUCCESS' };
  }

  async latestBlock(): Promise<number> {
    const { url, headers } = await this.grid();
    const res = await axios.post(`${url}/wallet/getnowblock`, {}, { headers, timeout: 20_000 });
    return Number(res.data?.block_header?.raw_data?.number ?? 0);
  }

  async requiredConfirmations() {
    return (await this.grid()).confirmations;
  }

  // ─── hot wallet ───

  private async tronWeb() {
    const { url, headers, contract } = await this.grid();
    const pk = await this.settings.get('tron.hot_wallet_private_key');
    if (!pk) throw new Error('HOT_WALLET_PRIVATE_KEY is not configured');
    const tw = new TronWeb({ fullHost: url, headers: headers['TRON-PRO-API-KEY'] ? { 'TRON-PRO-API-KEY': headers['TRON-PRO-API-KEY'] } : undefined, privateKey: pk.replace(/^0x/, '') });
    return { tw, contract };
  }

  async hotWalletAddress(): Promise<string | null> {
    const pk = await this.settings.get('tron.hot_wallet_private_key');
    if (!pk) return null;
    return TronService.addressFromPrivateKey(pk);
  }

  async hotWalletBalances(): Promise<{ address: string; usdt: string; trx: string } | null> {
    const address = await this.hotWalletAddress();
    if (!address) return null;
    if (this.simulated()) return { address, usdt: '100000', trx: '5000' };
    const { tw, contract } = await this.tronWeb();
    const c = tw.contract(TRC20_ABI as any, contract);
    const bal = await c.balanceOf(address).call();
    const trx = await tw.trx.getBalance(address);
    return { address, usdt: (Number(bal.toString()) / 1e6).toFixed(6), trx: (trx / 1e6).toFixed(6) };
  }

  async sendUsdt(to: string, amount: string): Promise<string> {
    if (this.simulated()) return `sim-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    const { tw, contract } = await this.tronWeb();
    const c = tw.contract(TRC20_ABI as any, contract);
    const sun = BigInt(Math.round(Number(amount) * 1e6));
    const txid: string = await c.transfer(to, sun.toString()).send({ feeLimit: 100_000_000, shouldPollResponse: false });
    return txid;
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      const block = await this.latestBlock();
      return { ok: block > 0, detail: `latest block ${block}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
