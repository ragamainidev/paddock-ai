import { assessmentAction } from '@/assessment-http/handlers';
export async function POST(
  request: Request,
  context: RouteContext<'/api/assessments/[id]/evidence'>,
) {
  return assessmentAction(request, (await context.params).id, 'evidence');
}
