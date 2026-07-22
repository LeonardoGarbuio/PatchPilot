import { Octokit } from '@octokit/rest'

export interface PRFileChange {
  path: string
  content: string | null // null means delete
}

export async function createPullRequest({
  githubToken,
  owner,
  repo,
  branchName,
  title,
  body,
  changes,
}: {
  githubToken: string
  owner: string
  repo: string
  branchName: string
  title: string
  body: string
  changes: PRFileChange[]
}) {
  const octokit = new Octokit({ auth: githubToken })

  // 1. Get the default branch and its latest commit SHA
  const { data: repository } = await octokit.repos.get({ owner, repo })
  const defaultBranch = repository.default_branch

  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  })
  const baseSha = refData.object.sha

  // 2. Create a new branch
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  })

  // 3. Get the base commit's tree
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  })
  const baseTreeSha = baseCommit.tree.sha

  // 4. Create a new tree with the changes
  const tree = changes.map((change) => ({
    path: change.path,
    mode: '100644' as const,
    type: 'blob' as const,
    content: change.content ?? undefined,
    sha: change.content === null ? null : undefined,
  }))

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    // @ts-ignore octokit types can be strict about sha vs content, this is a known workaround
    tree,
  })

  // 5. Create a commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: title,
    tree: newTree.sha,
    parents: [baseSha],
  })

  // 6. Update the branch reference
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  })

  // 7. Open the Pull Request
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title,
    body,
    head: branchName,
    base: defaultBranch,
  })

  return pr.html_url
}
