// The PR panel's one route: each action is the GitHub pull requests module's
// (project-git/pull-requests.js).
import { codePullRequestRequestSchema } from "./code-pull-request-schemas.js";
import { gitHubPullRequests } from "./project-git/pull-requests.js";
import { handleJsonRoute } from "./shared/json-route.js";

export function registerCodePullRequestRoutes(app) {
  app.post("/api/code-pull-requests", (c) =>
    handleJsonRoute(
      c,
      codePullRequestRequestSchema,
      gitHubPullRequests.execute,
      {
        errorMessage: "Unable to access GitHub.",
        invalidMessage: "Invalid pull request request.",
        missingBody: null,
      },
    ),
  );
}
