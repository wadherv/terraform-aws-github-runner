resource "aws_lambda_function" "webhook" {
  s3_bucket         = var.lambda_s3_bucket != null ? var.lambda_s3_bucket : null
  s3_key            = var.webhook_lambda_s3_key != null ? var.webhook_lambda_s3_key : null
  s3_object_version = var.webhook_lambda_s3_object_version != null ? var.webhook_lambda_s3_object_version : null
  filename          = var.lambda_s3_bucket == null ? local.lambda_zip : null
  source_code_hash  = var.lambda_s3_bucket == null ? filebase64sha256(local.lambda_zip) : null
  function_name     = "${var.prefix}-webhook"
  role              = aws_iam_role.webhook_lambda.arn
  handler           = "index.githubWebhook"
  runtime           = var.lambda_runtime
  timeout           = var.lambda_timeout
  architectures     = [var.lambda_architecture]

  environment {
    variables = {
      ENVIRONMENT                         = var.prefix
      LOG_LEVEL                           = var.log_level
      POWERTOOLS_LOGGER_LOG_EVENT         = var.log_level == "debug" ? "true" : "false"
      PARAMETER_GITHUB_APP_WEBHOOK_SECRET = var.github_app_parameters.webhook_secret.name
      REPOSITORY_WHITE_LIST               = jsonencode(var.repository_white_list)
      RUNNER_CONFIG                       = jsonencode([for k, v in var.runner_config : v])
      SQS_WORKFLOW_JOB_QUEUE              = try(var.sqs_workflow_job_queue, null) != null ? var.sqs_workflow_job_queue.id : ""
    }
  }

  dynamic "vpc_config" {
    for_each = var.lambda_subnet_ids != null && var.lambda_security_group_ids != null ? [true] : []
    content {
      security_group_ids = var.lambda_security_group_ids
      subnet_ids         = var.lambda_subnet_ids
    }
  }

  tags = var.tags

  dynamic "tracing_config" {
    for_each = var.lambda_tracing_mode != null ? [true] : []
    content {
      mode = var.lambda_tracing_mode
    }
  }
}

resource "aws_cloudwatch_log_group" "webhook" {
  name              = "/aws/lambda/${aws_lambda_function.webhook.function_name}"
  retention_in_days = var.logging_retention_in_days
  kms_key_id        = var.logging_kms_key_id
  tags              = var.tags
}

resource "aws_lambda_permission" "webhook" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/*/${local.webhook_endpoint}"
}

data "aws_iam_policy_document" "lambda_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "webhook_lambda" {
  name                 = "${var.prefix}-action-webhook-lambda-role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  path                 = local.role_path
  permissions_boundary = var.role_permissions_boundary
  tags                 = var.tags
}

resource "aws_iam_role_policy" "webhook_logging" {
  name = "${var.prefix}-lambda-logging-policy"
  role = aws_iam_role.webhook_lambda.name
  policy = templatefile("${path.module}/policies/lambda-cloudwatch.json", {
    log_group_arn = aws_cloudwatch_log_group.webhook.arn
  })
}

resource "aws_iam_role_policy_attachment" "webhook_vpc_execution_role" {
  count      = length(var.lambda_subnet_ids) > 0 ? 1 : 0
  role       = aws_iam_role.webhook_lambda.name
  policy_arn = "arn:${var.aws_partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "webhook_sqs" {
  name = "${var.prefix}-lambda-webhook-publish-sqs-policy"
  role = aws_iam_role.webhook_lambda.name

  policy = templatefile("${path.module}/policies/lambda-publish-sqs-policy.json", {
    sqs_resource_arns = jsonencode([for k, v in var.runner_config : v.arn])
    kms_key_arn       = var.kms_key_arn != null ? var.kms_key_arn : ""
  })
}

resource "aws_iam_role_policy" "webhook_workflow_job_sqs" {
  count = var.sqs_workflow_job_queue != null ? 1 : 0
  name  = "${var.prefix}-lambda-webhook-publish-workflow-job-sqs-policy"
  role  = aws_iam_role.webhook_lambda.name

  policy = templatefile("${path.module}/policies/lambda-publish-sqs-policy.json", {
    sqs_resource_arns = jsonencode([var.sqs_workflow_job_queue.arn])
    kms_key_arn       = var.kms_key_arn != null ? var.kms_key_arn : ""
  })
}

resource "aws_iam_role_policy" "webhook_ssm" {
  name = "${var.prefix}-lambda-webhook-publish-ssm-policy"
  role = aws_iam_role.webhook_lambda.name

  policy = templatefile("${path.module}/policies/lambda-ssm.json", {
    github_app_webhook_secret_arn = var.github_app_parameters.webhook_secret.arn,
  })
}

resource "aws_iam_role_policy" "xray" {
  count  = var.lambda_tracing_mode != null ? 1 : 0
  policy = data.aws_iam_policy_document.lambda_xray[0].json
  role   = aws_iam_role.webhook_lambda.name
}
