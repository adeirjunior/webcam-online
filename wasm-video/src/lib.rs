use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn rotate_90_clockwise(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let len = data.len();
    let mut rotated = vec![0u8; len];
    let new_width = height;
    
    // RGBA = 4 bytes per pixel
    for y in 0..height {
        for x in 0..width {
            let old_idx = ((y * width + x) * 4) as usize;
            
            // For 90 degrees clockwise:
            // new_x = height - 1 - y
            // new_y = x
            let new_x = height - 1 - y;
            let new_y = x;
            let new_idx = ((new_y * new_width + new_x) * 4) as usize;
            
            if new_idx + 3 < len && old_idx + 3 < len {
                rotated[new_idx] = data[old_idx];
                rotated[new_idx + 1] = data[old_idx + 1];
                rotated[new_idx + 2] = data[old_idx + 2];
                rotated[new_idx + 3] = data[old_idx + 3];
            }
        }
    }
    rotated
}

#[wasm_bindgen]
pub fn rotate_90_counter_clockwise(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let len = data.len();
    let mut rotated = vec![0u8; len];
    let new_width = height;
    
    for y in 0..height {
        for x in 0..width {
            let old_idx = ((y * width + x) * 4) as usize;
            
            // For 90 degrees counter-clockwise:
            // new_x = y
            // new_y = width - 1 - x
            let new_x = y;
            let new_y = width - 1 - x;
            let new_idx = ((new_y * new_width + new_x) * 4) as usize;
            
            if new_idx + 3 < len && old_idx + 3 < len {
                rotated[new_idx] = data[old_idx];
                rotated[new_idx + 1] = data[old_idx + 1];
                rotated[new_idx + 2] = data[old_idx + 2];
                rotated[new_idx + 3] = data[old_idx + 3];
            }
        }
    }
    rotated
}
