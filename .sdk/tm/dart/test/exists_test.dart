import 'harness.dart';

import '../lib/ProjectNameSDK.dart';

void tests() {
  describe('exists', () {
    test('test-mode', (t) async {
      final testsdk = ProjectNameSDK.test();
      equal(true, null != testsdk);
    });
  });
}
