import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('publish_hiripro', Path(__file__).parents[1] / 'scripts' / 'publish_hiripro.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

class PublishTests(unittest.TestCase):
    def row(self, **updates):
        return {'timestamp': '2026-10-02T10:00:00-03:00', 'sensor_id': 232, 'pm25_ugm3': 12.5, **updates}

    def test_filters_other_sensors_and_normalizes_timezone(self):
        rows = module.normalize([self.row(), self.row(sensor_id=31)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['timestamp'], '2026-10-02T13:00:00Z')
        self.assertEqual(rows[0]['sht_humidity_pct'], '')

    def test_rejects_invalid_data(self):
        for update in [{'timestamp': '2026-10-02T10:00:00'}, {'pm25_ugm3': 'NaN'}, {'sht_humidity_pct': 120}, {'pm1_ugm3': -1}]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                module.normalize([self.row(**update)])

    def test_partial_updates_preserve_history_and_are_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / '232.csv'
            module.publish([self.row(sht_temperature_c=18), self.row(timestamp='2026-10-01T10:00:00-03:00')], destination)
            changed, count = module.publish([self.row(pm25_ugm3=15)], destination)
            self.assertTrue(changed)
            self.assertEqual(count, 2)
            with destination.open(encoding='utf-8') as file:
                rows = list(module.csv.DictReader(file))
            self.assertEqual(float(rows[-1]['sht_temperature_c']), 18)
            changed, count = module.publish([self.row(pm25_ugm3=15)], destination)
            self.assertFalse(changed)

    def test_empty_api_does_not_replace_history(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / '232.csv'
            module.publish([self.row()], destination)
            original = destination.read_bytes()
            with self.assertRaises(ValueError):
                module.publish([self.row(sensor_id=39)], destination)
            self.assertEqual(destination.read_bytes(), original)

if __name__ == '__main__':
    unittest.main()
