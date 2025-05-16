import Serverless, { Options } from 'serverless'
import AwsProvider from 'serverless/plugins/aws/provider/awsProvider'
import { CloudFormation, APIGateway, S3 } from 'aws-sdk'
import { Commands, Hooks, Logging } from 'serverless/classes/Plugin'
import { Stage } from 'aws-sdk/clients/apigateway'

interface AwsProviderWithSdk extends AwsProvider {
  sdk?: {
    CloudFormation: typeof CloudFormation
    APIGateway: typeof APIGateway
    S3: typeof S3
  }
}

class VersionManager {
  private provider: AwsProviderWithSdk

  private stage: string

  private stack: string

  private cloudFormation: CloudFormation

  private env: {
    stack: string
    retainPolicy: string
    apiVersion?: string
  }

  private retainPolicy: number

  private commands: Commands

  private hooks: Hooks

  private log: Logging['log']

  constructor(private serverless: Serverless, cliOptions: Options, { log }: { log: Logging['log'] }) {
    this.log = log
    this.provider = this.serverless.getProvider('aws')
    this.stage = this.serverless.service.provider.stage || 'dev'
    this.stack = this.serverless.service.custom?.versionManager?.stack
    if (!this.stack) {
      throw new Error('Stack must be configured in custom.versionManager.stack')
    }
    this.cloudFormation = new this.provider.sdk!.CloudFormation({ region: this.serverless.service.provider.region })
    this.env = this.serverless.service.custom?.versionManager

    // Validate and parse retainPolicy
    const retainPolicy = this.env?.retainPolicy
    if (!retainPolicy) {
      throw new Error('retainPolicy must be configured in custom.versionManager.retainPolicy')
    }

    const parsedRetainPolicy = parseInt(retainPolicy, 10)
    if (Number.isNaN(parsedRetainPolicy) || parsedRetainPolicy <= 0) {
      throw new Error('retainPolicy must be a positive number')
    }
    this.retainPolicy = parsedRetainPolicy

    this.commands = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'version-manager': {
        usage: 'Manage API versions',
        lifecycleEvents: ['manage'],
        commands: {
          getVersions: {
            usage: 'Manage versions',
            lifecycleEvents: ['get-versions'],
          },
          cleanup: {
            usage: 'Clean up old versions',
            lifecycleEvents: ['cleanup'],
          },
        },
      },
    }

    this.hooks = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'version-manager:cleanup:cleanup': this.cleanupVersions.bind(this),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'after:deploy:deploy': this.afterDeploy.bind(this),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'before:package:createDeploymentArtifacts': this.validateVersion.bind(this),
    }
  }

  getNextVersion(currentVersions: string) {
    if (this.env.apiVersion) {
      return this.env.apiVersion
    }

    if (currentVersions.length === 0) {
      return '1.0.0'
    }

    const latestVersion = currentVersions[currentVersions.length - 1]
    const [major, minor, patch] = latestVersion.split('.').map(Number)

    return `${major}.${minor}.${patch + 1}`
  }

  async cleanupVersions() {
    const service = this.serverless.service.service
    if (service === null) throw new Error('Service is not defined')

    const orderedStages = await this.getStagesInOrder()
    // Keep only the most recent N stages based on retention policy
    const stagesToKeep = orderedStages?.slice(-this.retainPolicy)
    const stagesToDelete = orderedStages?.filter((stage) => !stagesToKeep?.includes(stage))
    if (stagesToDelete === undefined) throw new Error('Stages could not be determined')
    // Delete stages that are not in the retention policy
    for (const stage of stagesToDelete) {
      const version = stage.tags?.ALIAS
      if (stage.stageName === undefined) {
        this.log.error('STAGE undefined, continuing')
        continue
      }
      if (version === undefined) {
        this.log.info(`ALIAS not present for stage ${stage.stageName}`)
        continue
      }

      const aliasStackName = `${service || ''}-${this.stage}-${version}`
      this.log.info(`Removing stack for version: ${version}`)

      try {
        // Delete the CloudFormation stack
        // eslint-disable-next-line no-await-in-loop
        await this.cloudFormation.deleteStack({
          StackName: aliasStackName,
        }).promise()

        // Wait for stack deletion to complete
        // eslint-disable-next-line no-await-in-loop
        await this.cloudFormation.waitFor('stackDeleteComplete', {
          StackName: aliasStackName,
        }).promise()

        this.log.success(`Successfully removed stack for version: ${version}`)
      } catch (error: unknown) {
        this.log.error(`Warning: Error removing version ${version}: ${(error as unknown as Error).message}`)
      }
    }
  }

  semverSort = (a: Stage, b: Stage) => a.tags!.ALIAS
    .replace(/^v/, '').split(/[-.]/).map(Number)
    .reduce((acc, cur, i) => acc || cur - (b.tags?.ALIAS.replace(/^v/, '').split(/[-.]/).map(Number)[i] ?? 0), 0)

  isGreaterVersion = (greater: string, lesser: string) => {
    const v1 = greater.replace(/^v/, '').split(/[-.]/).map(Number)
    const v2 = lesser.replace(/^v/, '').split(/[-.]/).map(Number)

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0
      const num2 = v2[i] || 0

      if (num1 > num2) return true
      if (num1 < num2) return false
    }

    return false // versions are equal
  }

  async afterDeploy() {
    await this.cleanupVersions()
  }

  async validateVersion() {
    // Validate retainPolicy is present
    if (!this.env?.retainPolicy) {
      throw new Error('retainPolicy must be configured in custom.versionManager.retainPolicy')
    }

    if (this.env?.apiVersion === undefined) {
      throw new Error('apiVersion must be provided')
    }

    // Validate apiVersion format if present
    if (this.env?.apiVersion) {
      const versionRegex = /^v\d+-\d+-\d+$/
      if (!versionRegex.test(this.env.apiVersion)) {
        throw new Error('apiVersion must be in format vX-Y-Z (e.g., v3-2-0)')
      }
    }

    const orderedStages = await this.getStagesInOrder()
    const lastStage = orderedStages?.[orderedStages.length - 1]
    if (lastStage?.tags) {
      this.log.info(`Last deployed version: ${lastStage.stageName || 'undefined stage'}`)
      if (!this.isGreaterVersion(this.env.apiVersion, lastStage.tags.ALIAS)) {
        throw new Error(`The version provided: (${this.env.apiVersion}) should be greater than ${lastStage.tags.ALIAS}`)
      }
    }

    // Log the current retention policy
    this.log.info(`Using retention policy: ${this.env.retainPolicy} versions`)
  }

  async getStagesInOrder() {
    const service = this.serverless.service.service
    if (service === null) throw new Error('Service is not defined')

    const cloudformation = new this.provider.sdk!.CloudFormation({ region: this.serverless.service.provider.region })
    const stackName = `${service}-${this.stage}`
    const stack = await cloudformation.describeStacks({ StackName: stackName }).promise()
    const outputs = stack.Stacks?.[0].Outputs
    const apiGatewayOutput = outputs?.find((output) => output.OutputKey === 'ApiGatewayRestApi')
    const restApiId = apiGatewayOutput?.OutputValue
    if (restApiId === undefined) {
      throw new Error(`Rest API ID could not be found`)
    }
    const apigateway = new this.provider.sdk!.APIGateway({ region: this.serverless.service.provider.region })
    const stages = await apigateway.getStages({
      restApiId,
    }).promise()
    const versionStages = stages.item?.filter((stage) => stage.stageName?.startsWith('v'))
    versionStages?.sort(this.semverSort)
    return versionStages
  }
}

export default VersionManager
