import { HTTPError } from 'nitro'
import { ZodError } from 'zod'
import { WorkspaceError } from '../services/workspaces/profile'

/** Turns the workspace rules' errors into plain answers the page can show as they are. */
export async function workspaceRoute<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err: any) {
    if (err instanceof WorkspaceError) throw new HTTPError({ statusCode: err.status, statusMessage: err.message })
    if (err instanceof ZodError) throw new HTTPError({ statusCode: 400, statusMessage: err.issues[0]?.message ?? 'That is not valid.' })
    throw err
  }
}
