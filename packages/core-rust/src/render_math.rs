pub(crate) fn compose_matrix(
    position: [f32; 3],
    rotation: [f32; 3],
    scale: [f32; 3],
) -> [f32; 16] {
    let [sx, sy, sz] = scale;
    let [rx, ry, rz] = rotation;
    let [tx, ty, tz] = position;

    let (sin_x, cos_x) = rx.sin_cos();
    let (sin_y, cos_y) = ry.sin_cos();
    let (sin_z, cos_z) = rz.sin_cos();

    let m00 = cos_y * cos_z;
    let m01 = cos_z * sin_x * sin_y - cos_x * sin_z;
    let m02 = sin_x * sin_z + cos_x * cos_z * sin_y;

    let m10 = cos_y * sin_z;
    let m11 = cos_x * cos_z + sin_x * sin_y * sin_z;
    let m12 = cos_x * sin_y * sin_z - cos_z * sin_x;

    let m20 = -sin_y;
    let m21 = cos_y * sin_x;
    let m22 = cos_x * cos_y;

    [
        m00 * sx, m01 * sx, m02 * sx, 0.0,
        m10 * sy, m11 * sy, m12 * sy, 0.0,
        m20 * sz, m21 * sz, m22 * sz, 0.0,
        tx, ty, tz, 1.0,
    ]
}

pub(crate) fn multiply_matrix(left: [f32; 16], right: [f32; 16]) -> [f32; 16] {
    let mut result = [0.0; 16];
    for row in 0..4 {
        for column in 0..4 {
            result[row * 4 + column] =
                left[row * 4] * right[column] +
                left[row * 4 + 1] * right[4 + column] +
                left[row * 4 + 2] * right[8 + column] +
                left[row * 4 + 3] * right[12 + column];
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn matrix_contains_translation() {
        let matrix = compose_matrix([1.0, 2.0, 3.0], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
        assert_eq!(matrix[12], 1.0);
        assert_eq!(matrix[13], 2.0);
        assert_eq!(matrix[14], 3.0);
        assert_eq!(matrix[15], 1.0);
    }

    #[test]
    fn matrix_multiply_combines_parent_and_child_translation() {
        let parent = compose_matrix([10.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
        let child = compose_matrix([3.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]);
        let world = multiply_matrix(parent, child);

        assert_eq!(world[12], 13.0);
        assert_eq!(world[13], 0.0);
        assert_eq!(world[14], 0.0);
    }

    #[test]
    fn matrix_composition_micro_benchmark_budget() {
        let start = Instant::now();
        let mut checksum = 0.0;
        for index in 0..100_000 {
            let value = index as f32 * 0.001;
            let matrix = compose_matrix(
                [value, value * 0.5, value * 0.25],
                [value * 0.1, value * 0.2, value * 0.3],
                [1.0, 1.0, 1.0],
            );
            checksum += matrix[0] + matrix[5] + matrix[10] + matrix[12];
        }
        let elapsed = start.elapsed();
        assert!(checksum.is_finite());
        assert!(
            elapsed.as_millis() < 250,
            "100k matrix compositions should stay under 250ms in native tests, got {:?}",
            elapsed
        );
    }
}
