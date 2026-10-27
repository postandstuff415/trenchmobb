import type { Address, Instruction } from '@solana/kit';
import { config } from '../config';
import { transferSolIx } from './instructions';

/**
 * The platform fee. It is placed in the same transaction as the Kamino borrow that opens
 * the short, so it is only charged if the short actually opens (transactions are atomic).
 */
export function platformFeeIx(payer: Address): Instruction {
  return transferSolIx(payer, config.feeWallet, config.feeLamports);
}
