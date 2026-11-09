import { defineHandler } from 'nitro'
import { requireUser } from '../../utils/session'
import { publicSchedule, taskScheduleStore } from '../../services/tasks/schedules'

export default defineHandler(async (event) => {
  const user = await requireUser(event)
  return (await taskScheduleStore().list(user.id)).map(publicSchedule)
})
