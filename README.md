# Serverless Version Manager

A Serverless Framework plugin that enables automatic version management for APIs using `serverless-aws-alias-v3`. This plugin helps manage API versions by implementing a retention policy system, ensuring that only the most recent versions of your API are kept while automatically cleaning up older versions.

## Features

- Automatic version management for API Gateway stages
- Configurable retention policy to keep only the most recent N versions
- Automatic cleanup of old API versions
- Semantic versioning support for API versions
- Integration with `serverless-aws-alias-v3` for alias management

## Prerequisites

- Serverless Framework (>=3.38)
- serverless-aws-alias-v3 (>=3.2.0)

## Installation

```bash
npm install --save-dev serverless-version-manager
```

## Configuration

Add the plugin to your `serverless.yml`:

```yaml
plugins:
  - serverless-version-manager

custom:
  versionManager:
    stack: your-stack-name
    retainPolicy: 5  # Number of versions to retain
    apiVersion: v1-0-0  # Optional: Specify version for deployment
```

### Configuration Options

- `stack`: (Required) The name of your CloudFormation stack
- `retainPolicy`: (Required) Number of versions to retain
- `apiVersion`: (Optional) Specific version to deploy (format: vX-Y-Z)

## Usage

### Automatic Version Management

The plugin automatically manages versions during deployment. When you deploy your service, it will:

1. Create a new version if specified or increment the latest version
2. Clean up old versions based on the retention policy
3. Ensure version numbers are always increasing

### Manual Commands

The plugin provides two main commands:

```bash
# List all current versions
serverless version-manager getVersions

# Manually trigger cleanup of old versions
serverless version-manager cleanup
```

## Version Format

Versions should follow the format `vX-Y-Z` (e.g., v1-0-0). The plugin ensures that:
- New versions are always greater than the previous version
- Versions are properly sorted and managed
- Old versions are automatically cleaned up based on the retention policy

## How It Works

1. During deployment, the plugin validates the version number and retention policy
2. It creates a new API Gateway stage for the version
3. After deployment, it automatically cleans up old versions based on the retention policy
4. The plugin uses CloudFormation to manage the lifecycle of API versions

## License

ISC
