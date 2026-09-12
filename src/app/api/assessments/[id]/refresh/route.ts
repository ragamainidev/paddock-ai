import { assessmentAction } from '@/assessment-http/handlers';
export async function POST(
  request: Request,
  context: RouteContext<'/api/assessments/[id]/refresh'>,
) {
  return assessmentAction(request, (await context.params).id, 'refresh');
}
