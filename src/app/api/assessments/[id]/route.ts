import { assessmentDetail } from '@/assessment-http/handlers';
export async function GET(request: Request, context: RouteContext<'/api/assessments/[id]'>) {
  return assessmentDetail(request, (await context.params).id);
}
