import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

/**
 * Apple 4.8: Sign in with Apple sits alongside Google. Drive is authorized
 * LATER, as a separate "connect your storage" step — keeping Drive a data
 * integration rather than a login method.
 */
export default function SignIn() {
  return (
    <View style={s.wrap}>
      <Text style={s.h1}>Bouquet</Text>
      <Text style={s.sub}>Your guests&apos; photos, in your own storage.</Text>

      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={12}
        style={s.apple}
        onPress={() => {/* TODO: exchange identityToken with /api/auth/apple */}}
      />

      <Pressable style={s.alt}><Text style={s.altText}>Continue with email</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#FBF9F4' },
  h1: { fontSize: 32, fontWeight: '500', color: '#2C2B28' },
  sub: { fontSize: 16, color: '#6F6D66', marginTop: 8, marginBottom: 36 },
  apple: { height: 52, width: '100%' },
  alt: { height: 52, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E6E1D6', justifyContent: 'center', alignItems: 'center' },
  altText: { fontSize: 16, color: '#2C2B28' },
});
