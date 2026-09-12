import { AssessmentView } from '@/ui/assessments/view';
export default async function AssessmentPage(props: PageProps<'/assessments/[id]'>) {
  return <AssessmentView id={(await props.params).id} />;
}
