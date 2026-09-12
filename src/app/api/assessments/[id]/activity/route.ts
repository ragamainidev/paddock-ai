import { assessmentActivity } from '@/assessment-http/handlers';

export async function GET(
  request: Request,
  context: RouteContext<'/api/assessments/[id]/activity'>,
) {
  return assessmentActivity(request, (await context.params).id);
}
