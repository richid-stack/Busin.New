import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { publicTask, taskStore } from '../../services/tasks/store'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return (await taskStore().list(user.id)).map(publicTask)
})
