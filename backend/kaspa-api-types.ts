// Wire shapes verified against the api-tn10.kaspa.org REST OpenAPI (v2.3.0).
// The chain client returns these raw; higher layers derive their own views.

export interface BalanceResponse {
  address: string;
  balance: number;
}

export interface TxModel {
  subnetwork_id: string;
  transaction_id: string;
  hash: string;
  mass: string;
  payload: string;
  block_hash: string[];
  block_time: number;
  version: number;
  is_accepted: boolean;
  accepting_block_hash: string;
  accepting_block_blue_score: number;
  accepting_block_time: number;
  inputs: TxInput[];
  outputs: TxOutput[];
}

export interface TxInput {
  transaction_id: string;
  index: number;
  previous_outpoint_hash: string;
  previous_outpoint_index: string;
  previous_outpoint_resolved?: TxOutput;
  previous_outpoint_address?: string;
  previous_outpoint_amount?: number;
  signature_script: string;
  sig_op_count: string;
  compute_budget?: number;
  covenant_id?: string;
}

export interface TxOutput {
  transaction_id: string;
  index: number;
  amount: number;
  script_public_key: string;
  script_public_key_address?: string;
  script_public_key_type?: string;
  covenant_authorizing_input?: number;
  covenant_id?: string;
}

export interface UtxoResponse {
  address?: string;
  outpoint: OutpointModel;
  utxoEntry: UtxoModel;
}

export interface OutpointModel {
  transactionId: string;
  index: number;
}

export interface UtxoModel {
  amount: string;
  scriptPublicKey: ScriptPublicKeyModel;
  blockDaaScore: string;
  isCoinbase: boolean;
}

export interface ScriptPublicKeyModel {
  scriptPublicKey: string;
}

export interface FeeEstimateResponse {
  priorityBucket: FeeEstimateBucket;
  normalBuckets: FeeEstimateBucket[];
  lowBuckets: FeeEstimateBucket[];
}

export interface FeeEstimateBucket {
  feerate: number;
  estimatedSeconds: number;
}

export interface SubmitTransactionRequest {
  transaction: SubmitTxModel;
  allowOrphan?: boolean;
}

export interface SubmitTxModel {
  version: number;
  inputs: SubmitTxInput[];
  outputs: SubmitTxOutput[];
  lockTime?: number;
  subnetworkId?: string;
}

export interface SubmitTxInput {
  previousOutpoint: SubmitTxOutpoint;
  signatureScript: string;
  sequence: number;
  sigOpCount: number;
}

export interface SubmitTxOutpoint {
  transactionId: string;
  index: number;
}

export interface SubmitTxOutput {
  amount: number;
  scriptPublicKey: SubmitTxScriptPublicKey;
}

export interface SubmitTxScriptPublicKey {
  version: number;
  scriptPublicKey: string;
}

export interface SubmitTransactionResponse {
  transactionId?: string;
  error?: string;
}
