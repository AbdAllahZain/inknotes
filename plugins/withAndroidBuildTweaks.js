/**
 * Small Android build tweaks applied automatically on every `expo prebuild`
 * (GitHub Actions, EAS Build or local):
 *  - lint never blocks the release build (lintVital is not needed for a sideloaded APK)
 *  - duplicate native libs shared by several modules (libc++_shared, libfbjni) are merged
 *  - Gradle gets more memory (Skia + Reanimated + Kotlin need more than the 2 GB default)
 */
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARK = '// InkNotes build tweaks';

module.exports = function withAndroidBuildTweaks(config) {
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') return c;
    let s = c.modResults.contents;
    if (!s.includes(MARK)) {
      s = s.replace(
        /android\s*\{/,
        (m) =>
          m +
          `\n    ${MARK}\n    lint {\n        checkReleaseBuilds false\n        abortOnError false\n    }\n` +
          `    packagingOptions {\n        pickFirst '**/libc++_shared.so'\n        pickFirst '**/libfbjni.so'\n    }`
      );
    }
    c.modResults.contents = s;
    return c;
  });

  config = withGradleProperties(config, (c) => {
    const set = (key, value) => {
      const i = c.modResults.findIndex((p) => p.type === 'property' && p.key === key);
      if (i >= 0) c.modResults[i].value = value;
      else c.modResults.push({ type: 'property', key, value });
    };
    set('org.gradle.jvmargs', '-Xmx4g -XX:MaxMetaspaceSize=1g');
    set('org.gradle.parallel', 'false');
    return c;
  });

  return config;
};
