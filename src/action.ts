import { Toolkit } from 'actions-toolkit';
import { EventPayloads } from '@octokit/webhooks';
import PushPayload from './pushPayload';
import GithubOrganization from './githubOrganization';
import MembersFile from './membersFile';

async function readMembersFile(tools: Toolkit): Promise<MembersFile> {
  const contents = await tools.readFile(MembersFile.FILENAME);
  /* istanbul ignore else */
  if (typeof contents === 'string') {
    return new MembersFile(contents, tools.log);
  } else {
    return new MembersFile(contents.toString(), tools.log);
  }
}

async function synchronizeOrganizationMembership(
  tools: Toolkit,
  organization: GithubOrganization,
  membersFile: MembersFile,
): Promise<void> {
  if (membersFile.isEmpty()) {
    tools.exit.failure('Empty members file: this action will not let you remove ALL members from this organization');
    return;
  }

  tools.log('Invite new members or update existing members');
  const addOrUpdateMembershipResults = await organization.inviteNewMembers(membersFile.allMembers);
  addOrUpdateMembershipResults.printResults(tools.log);

  tools.log('Remove members');
  const removeMembershipResults = await organization.removeMembers(membersFile.allMembers);
  removeMembershipResults.printResults(tools.log);

  if (addOrUpdateMembershipResults.hasErrors() || removeMembershipResults.hasErrors()) {
    tools.exit.failure('Completed with errors, see the logs above');
  } else {
    tools.exit.success('Completed!');
  }
}

function logError(tools: Toolkit, error: { message: string; errors: object[] | undefined }): void {
  tools.log.error(error.message, error);
  if (error.errors) {
    tools.log.error(error.errors);
  }
}

export default async function (tools: Toolkit): Promise<void> {
  try {
    tools.log('Verify if organization membership file was modified');

    const payloadWrapper: PushPayload = new PushPayload(tools.context.payload as EventPayloads.WebhookPayloadPush);

    if (!payloadWrapper.isOrganizationOwned()) {
      tools.exit.failure('Not an organization repository, nothing to do');
      return;
    }

    if (!payloadWrapper.isDefaultBranch()) {
      tools.exit.success('Not working on default branch, nothing to do');
      return;
    }

    const membersFileModified: boolean = await payloadWrapper.fileWasModified(
      MembersFile.FILENAME,
      tools.context.repo,
      tools.github,
    );

    if (!membersFileModified) {
      tools.exit.success(`"${MembersFile.FILENAME}" not modified, this is ok, nothing to do`);
    } else {
      const organizationName = payloadWrapper.organizationLogin;
      tools.log('%s was modified, modifying %s membership...', MembersFile.FILENAME, organizationName);
      const membersFile = await readMembersFile(tools);
      const organization = new GithubOrganization(organizationName, tools.github);

      await synchronizeOrganizationMembership(tools, organization, membersFile);
    }
  } catch (error) {
    logError(tools, error);

    tools.exit.failure(`An error occurred while modifying organization membership\n\n${error.message}`);
  }
}
