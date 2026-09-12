// Git hooks export repository-local variables. Child Git commands targeting a
// different checkout must not inherit that repository, index, or config scope.
export function isolatedGitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const isolated = { ...env };
  for (const name of Object.keys(isolated)) {
    if (name.startsWith('GIT_')) delete isolated[name];
  }
  return isolated;
}
