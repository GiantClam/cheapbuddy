import unittest

import torch

from cheapbuddy.images import stack_images


class ImageBatchTests(unittest.TestCase):
    def test_stack_images_pads_mixed_dimensions(self):
        first = torch.ones((1, 2, 3, 3))
        second = torch.full((1, 4, 2, 3), 0.5)

        result = stack_images([first, second])

        self.assertEqual(tuple(result.shape), (2, 4, 3, 3))
        self.assertTrue(torch.equal(result[0, :2, :3], first[0]))
        self.assertTrue(torch.equal(result[1, :4, :2], second[0]))
        self.assertTrue(torch.equal(result[0, 2:, :], torch.zeros((2, 3, 3))))
        self.assertTrue(torch.equal(result[1, :, 2:], torch.zeros((4, 1, 3))))

    def test_stack_images_keeps_equal_dimensions(self):
        first = torch.zeros((1, 3, 3, 3))
        second = torch.ones((1, 3, 3, 3))

        result = stack_images([first, second])

        self.assertTrue(torch.equal(result, torch.cat([first, second], dim=0)))


if __name__ == "__main__":
    unittest.main()
