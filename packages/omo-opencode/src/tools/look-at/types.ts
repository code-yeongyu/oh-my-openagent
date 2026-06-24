export interface LookAtArgs {
  file_path?: string
  file_paths?: string[]
  image_data?: string  // base64 encoded image data (for clipboard images)
  image_data_list?: string[]
  goal: string
}
