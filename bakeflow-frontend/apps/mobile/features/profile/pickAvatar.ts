import * as ImagePicker from 'expo-image-picker';

export type PickedPhoto = { uri: string; mimeType: string } | { denied: true } | null;

/**
 * Choose or take a square profile photo. Returns null when the person cancels and `{ denied }` when
 * they refuse permission. JPEG at 0.6 quality keeps a typical phone photo well under the 2 MB limit of
 * the `avatars` bucket without an extra image-processing package.
 */
export async function pickAvatar(source: 'library' | 'camera'): Promise<PickedPhoto> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { denied: true };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.6,
    exif: false,
  };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset === undefined) return null;
  const type = asset.mimeType ?? (asset.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
  return { uri: asset.uri, mimeType: type === 'image/jpg' ? 'image/jpeg' : type };
}
