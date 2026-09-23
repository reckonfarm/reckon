import { LEDGER_STAMP_AUDIT } from '@/lib/ledger-through'

// Block 32: what this render read — see lib/ledger-through.ts. Nothing a
// person sees; SyncRefresh and the suites read it. An empty stamp is a ranch
// with no records yet, and still a ledger page.
export default function LedgerStamp({ through }: { through: string | null }) {
  return <span hidden data-audit={LEDGER_STAMP_AUDIT} data-through={through ?? ''} />
}
