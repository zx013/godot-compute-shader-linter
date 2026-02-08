#[compute]
#version 450

#include "test02.comp.glsl"
#include "test03.comp.glsl"

layout(local_size_x = 2, local_size_y = 1, local_size_z = 1) in;

layout(set = 0, binding = 0, std430) restrict buffer MyDataBuffer {
    float data[];
} my_data_buffer;

void main() {
    int value = test_func(int(my_data_buffer.data[gl_GlobalInvocationID.x]));
    value = test_func_02(value);
    my_data_buffer.data[gl_GlobalInvocationID.x] = float(value);
}