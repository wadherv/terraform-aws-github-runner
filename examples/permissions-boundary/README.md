# Action runners deployed with permissions boundary

This module shows how to create GitHub action runners with permissions boundaries and paths used in role, policies, and instance profiles.

## Usages

Steps for the full setup, such as creating a GitHub app can be find the module [README](../../README.md). First create the deploy role and boundary policies. These steps require an admin user.

> Ensure you have set the version in `lambdas-download/main.tf` for running the example. The version needs to be set to a GitHub release version, see https://github.com/philips-labs/terraform-aws-github-runner/releases


```bash
cd setup
terraform init
terraform apply
cd ..
```

Now a new role and policies should be created. The output of the previous step is imported in this workspace to load the role and policy. The deployment of the runner module assumes the new role before creating all resources (https://www.terraform.io/docs/providers/aws/index.html#assume-role). Before running Terraform, ensure the GitHub app is configured.

Download the lambda releases.

```bash
cd ../lambdas-download
terraform init
terraform apply -var=module_version=<VERSION>
cd -
```

Now you can deploy the module.

```bash
terraform init
terraform apply
```

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.3.0 |
| <a name="requirement_aws"></a> [aws](#requirement\_aws) | ~> 4.0 |
| <a name="requirement_local"></a> [local](#requirement\_local) | ~> 2.0 |
| <a name="requirement_random"></a> [random](#requirement\_random) | ~> 3.0 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_aws"></a> [aws](#provider\_aws) | 4.46.0 |
| <a name="provider_random"></a> [random](#provider\_random) | 3.4.3 |
| <a name="provider_terraform"></a> [terraform](#provider\_terraform) | n/a |

## Modules

| Name | Source | Version |
|------|--------|---------|
| <a name="module_runners"></a> [runners](#module\_runners) | ../../ | n/a |
| <a name="module_vpc"></a> [vpc](#module\_vpc) | terraform-aws-modules/vpc/aws | 3.11.2 |

## Resources

| Name | Type |
|------|------|
| [aws_kms_alias.github](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_alias) | resource |
| [aws_kms_key.github](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/kms_key) | resource |
| [random_id.random](https://registry.terraform.io/providers/hashicorp/random/latest/docs/resources/id) | resource |
| [terraform_remote_state.iam](https://registry.terraform.io/providers/hashicorp/terraform/latest/docs/data-sources/remote_state) | data source |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_github_app"></a> [github\_app](#input\_github\_app) | GitHub for API usages. | <pre>object({<br>    id         = string<br>    key_base64 = string<br>  })</pre> | n/a | yes |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_runners"></a> [runners](#output\_runners) | n/a |
| <a name="output_webhook"></a> [webhook](#output\_webhook) | n/a |
<!-- END_TF_DOCS -->