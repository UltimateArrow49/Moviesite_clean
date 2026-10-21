# Privacy cleanup and remaining actions

Published branch histories were cleaned on 21 October 2026. Personal author and committer names and emails were replaced with a generic contributor identity. Known historical credentials, workstation paths, and operator-specific server details were redacted. Previously committed virtual environments, database/cache files, and backup copies were removed from the rewritten history.

The application now reads its admin sync key from a private environment variable and denies admin access when no key is configured. The setup guide keeps the backend, environment file, and SQLite database outside the public frontend folder. Automated checks inspect tracked files for common credentials and private runtime artifacts without printing matched values.

## Remaining actions outside this repository

- Revoke or rotate previously exposed TMDB and Backblaze application credentials in those provider accounts. Removing them from Git does not revoke access. Choose a new admin sync passphrase before configuring the cleaned application.
- Start from a fresh clone. Do not merge or push from a clone containing the previous history.
- Ask GitHub Support to purge sensitive data from cached commit views and pull-request references. GitHub maintains pull-request refs that repository owners cannot rewrite with a Git push. Rewriting branches does not erase those references, forks, other people's clones, or copies made before cleanup.
- Keep the private recovery backup outside this repository. Never upload it as an issue attachment or release asset.

See [GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository#fully-removing-the-data-from-github) for the support process. Do not paste actual credentials into the request.

The scan checked known personal identifiers, commit metadata, credential patterns, and private file types. It cannot prove that arbitrary personal data is absent from every external copy. This change updates the repository; existing server configuration must be migrated separately using SETUP.md.
