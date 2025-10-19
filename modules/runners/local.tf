locals {
  parameter_store_tags = [
    for k, v in var.parameter_store_tags : {
      Key = k
      Value = v
    }
  ]
}
