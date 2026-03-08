import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'
import type { Router } from '@rzyns/strus-api/router'

const link = new RPCLink({ url: window.location.origin + '/rpc' })

// RouterClient<Router> maps server-side DecoratedProcedure definitions to
// their callable client equivalents, satisfying NestedClient<any>.
export const api = createORPCClient(link) as RouterClient<Router>
