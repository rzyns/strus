import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { Router } from '../../../api/src/router'

const link = new RPCLink({ url: '/api' })

export const api = createORPCClient<Router>(link)
