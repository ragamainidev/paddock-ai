import { prefilledVin } from '@/ui/assessments/intake-form';
import { AssessmentWorkspace } from '@/ui/assessments/workspace';

// `searchParams` is a Promise in this Next.js; the showroom's
// `assess a lot like this` arrives as `?vin=` and seeds the intake field,
// so nothing is prefilled unless the reader chose that action (SPEC 61).
export default async function AssessmentsPage(props: PageProps<'/assessments'>) {
  const { vin } = await props.searchParams;
  return <AssessmentWorkspace vin={prefilledVin(vin)} />;
}
